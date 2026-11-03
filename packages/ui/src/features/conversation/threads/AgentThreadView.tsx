import type {
  AgentApproval,
  AgentTask,
  AgentTaskHold,
  AttachmentSummary,
  DraftAttachment,
  InstalledSkill,
  QueueDelivery,
} from "@buildersbot/contracts/ipc";
import type { AppTextKey } from "@buildersbot/i18n";
import { isAgentTaskActive } from "@buildersbot/team-client/agent-tasks";
import { createScrollFades } from "@buildersbot/ui/components/createScrollFades";
import type { AgentMessage, AgentProfile, ComposerMcpServer } from "@buildersbot/ui/data";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@buildersbot/ui/features/conversation/AgentActivity";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsFacts,
} from "@buildersbot/ui/features/conversation/AgentSteps";
import { branchPointIds } from "@buildersbot/ui/features/conversation/branch-points";
import { type ChatMessageAuthor, ChatMessageRow } from "@buildersbot/ui/features/conversation/ChatMessageRow";
import { ComposerAddMenu } from "@buildersbot/ui/features/conversation/ComposerAddMenu";
import {
  ComposerEditor,
  type ComposerPasteResult,
  type ComposerSelection,
} from "@buildersbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@buildersbot/ui/features/conversation/ComposerNotice";
import { ComposerSendControl } from "@buildersbot/ui/features/conversation/ComposerSendControl";
import { ContextUsageMeter, type ContextUsageView } from "@buildersbot/ui/features/conversation/ContextUsage";
import { ApprovalCard } from "@buildersbot/ui/features/conversation/ConversationPrompts";
import { MessageActions, MessageMenu } from "@buildersbot/ui/features/conversation/MessageRendering";
import type { SendShortcut } from "@buildersbot/ui/features/conversation/send-shortcut";
import { ComposerVoiceControls, type VoicePhase } from "@buildersbot/ui/features/conversation/VoiceRecordingMorph";
import { type TextValue, useText } from "@buildersbot/ui/text";
import type { JSX } from "@solidjs/web";
import {
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  Loading,
  lazy,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { type AgentThreadBranchSource, BranchDivider } from "./BranchDivider";

const HOLD_TEXT = {
  "agent-restarting": "conversation.threads.hold.agentRestarting",
  "usage-limit": "conversation.threads.hold.usageLimit",
  "server-busy": "conversation.threads.hold.serverBusy",
  "agent-busy": "conversation.threads.hold.agentBusy",
  "one-turn": "conversation.threads.hold.oneTurn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, AppTextKey>;

/** The list stays at its end while new text comes in, when the user has not scrolled up. */
const STICK_DISTANCE = 48;

/**
 * Whether the thread shows this message as a row. A stopped turn can leave an agent message with no
 * text and nothing else in it. The thinking and the memory changes of a turn show in its steps.
 */
function shownInThread(message: AgentMessage): boolean {
  if (message.kind === "thinking" || message.kind === "memory-changes") return false;
  // The question that the Quick chat sent to another agent is a row for its agent strip, not a message to read.
  if (message.exchange?.direction === "outgoing") return false;
  return (
    message.author === "you" ||
    message.streaming === true ||
    message.body.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    message.imageGeneration !== undefined ||
    message.questionPrompt !== undefined ||
    message.plan !== undefined ||
    message.actionMarker !== undefined
  );
}

/** Why the next message of a queued thread waits. */
export function agentThreadHoldText(task: AgentTask, limit: number, t: TextValue["t"]): string | null {
  if (task.state !== "queued") return null;
  // A queued thread with no named wait has no text: the limit of threads is named only when it is the reason.
  if (task.hold === null) return null;
  if (task.hold === "task-limit") return t("conversation.threads.hold.threadLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}

/** What a person does with the messages that wait in a thread. */
export interface AgentThreadQueueActions {
  /** Absent where the thread's provider cannot steer a running turn. */
  onSteer?: ((deliveryId: string) => void) | undefined;
  onCancel: (deliveryId: string) => void;
  /** `deliveryIds` is the whole queue of the thread in its new order. */
  onReorder: (deliveryIds: string[]) => void;
}

const QueuePanel = lazy(() =>
  import("@buildersbot/ui/features/conversation/QueuePanel").then((module) => ({ default: module.QueuePanel })),
);

/** A queued message of a thread as the queue panel reads it: the thread's own order is its position. */
function queueDeliveries(task: AgentTask, agentId: string): QueueDelivery[] {
  return task.queuedMessages.map((message, index) => ({
    id: message.deliveryId,
    messageId: message.deliveryId,
    recipientAgentId: agentId,
    sender: { kind: "user" },
    text: message.text,
    attachments: [],
    replyToMessageId: null,
    status: "queued",
    position: index + 1,
    turnId: null,
    error: null,
    createdAt: message.createdAt,
  }));
}

/** Dictation into the thread's message box, as in the agent's own chat. */
export interface AgentThreadVoice {
  /** The phase of this thread's recording; "idle" when it has none. */
  phase: VoicePhase;
  /** Another message box records, so this one cannot start. */
  blocked: boolean;
  /** What was said so far. */
  liveText: string;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** Stops the recording and sends the message with its text. */
  onSend: () => void;
}

export interface AgentThreadViewProps {
  /** Null for a new thread: its first message starts it. */
  task: AgentTask | null;
  /** How many threads of the agent can run at the same time. */
  limit: number;
  agent: AgentProfile;
  agents: AgentProfile[];
  messages: readonly AgentMessage[];
  /** The agent's skills, for the `$` picker and the skill tags in messages. */
  skills?: InstalledSkill[] | undefined;
  /** The last skill list request failed, so an empty picker says so instead of "no skills". */
  skillsLoadFailed?: boolean | undefined;
  /** The host's MCP servers, offered by the same `$` the skills answer. */
  mcpServers?: ComposerMcpServer[] | undefined;
  /** The unsent text of this thread's message box. The host keeps it for each thread. */
  draft: string;
  /** The files that the draft names. */
  draftAttachments?: DraftAttachment[] | undefined;
  onDraftChange: (text: string) => void;
  /** Receives pasted files. Without it, a file paste does nothing here. */
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onOpenDraftAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  /** Opens the file picker. Without it, the "+" menu has no image or context item. */
  onAttachFiles?: (() => void) | undefined;
  /** Opens the agent's side question with the draft. Without it, the "+" menu has no side question. */
  onSideQuestion?: (() => void) | undefined;
  /** Without it, the message box has no microphone. */
  voice?: AgentThreadVoice | undefined;
  /** Each increase moves the caret to the end of the text, as after a dictation. */
  focusRequest?: number | undefined;
  /** Sends a message. The host clears the text when the message went; when it did not, the text stays. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
  /** The approval that the thread's running turn waits for. */
  approval?: AgentApproval | undefined;
  onRespondApproval: (decision: "accept" | "decline") => Promise<boolean>;
  /** How full the thread's context is, when its provider reported it. */
  context?: ContextUsageView | undefined;
  /** Compacts the thread's context now. Missing when the host cannot. */
  onCompactContext?: (() => Promise<void>) | undefined;
  /** Whether the thread's running turn waits for the person: a question or a browser takeover. */
  waitsForAnswer?: boolean | undefined;
  /** Another card that the thread shows, such as a question or a browser takeover. The app builds it. */
  attention?: JSX.Element | undefined;
  /** Reads an answer aloud, as the agent's own chat does. Absent for a message that cannot be read, or without speech. */
  readAloud?: ((message: AgentMessage) => { reading: boolean; onToggle: () => void } | undefined) | undefined;
  /** What the menu of an answer shows when `readAloud` has nothing to read yet, such as the offer of the voice download. */
  readAloudOffer?: ((message: AgentMessage) => { reading: boolean; onToggle: () => void } | undefined) | undefined;
  /** What shows above the message box, such as the bar of a reply that is read aloud now. */
  aboveComposer?: JSX.Element | undefined;
  /** The steps of the finished turn above an answer, or undefined for a message that has none. */
  stepsAbove?: ((messageId: string) => AgentStep[] | undefined) | undefined;
  /** The time that the turn of an answer took, and how many of its steps failed. */
  factsAbove?: ((messageId: string) => AgentStepsFacts | undefined) | undefined;
  /** The steps of the running turn, for its activity row. */
  activeSteps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open at first. */
  stepsOpenByDefault?: boolean | undefined;
  /** Receives the message list, where the app searches the thread. */
  scrollRef?: ((element: HTMLElement) => void) | undefined;
  /** The user's send shortcut. Enter when absent. */
  sendShortcut?: SendShortcut | undefined;
  /** Copies a message. Without it, the messages have no action row and no right-click menu. */
  onCopyMessage?: ((message: AgentMessage) => void) | undefined;
  /** The message that the copy action copied a moment ago. */
  copiedMessageId?: string | null | undefined;
  /**
   * Copies the thread through an answer into a new thread. Only the last answer of each finished turn
   * offers it. Missing where the host cannot branch.
   */
  onBranch?: ((messageId: string) => void) | undefined;
  /** Where the thread came from, when it is a branch. A line shows after the copied messages. */
  branchSource?: AgentThreadBranchSource | undefined;
  /**
   * The actions of the messages that wait in this thread. With it, they show as the queue of the agent's own
   * chat does: a person steers one into the running turn, deletes it, or drags it up or down to set its
   * priority. Without it, the thread only lists them.
   */
  queue?: AgentThreadQueueActions | undefined;
  /** A message to scroll to and mark once, when it shows. Each new request has a new nonce. */
  focusMessage?: { messageId: string; nonce: number } | undefined;
}

/**
 * A side thread of an agent, in the place of its chat: the messages, why the thread waits, and a
 * message box. While a turn runs, a message waits in the thread, or steers the turn as the
 * busy-message mode says.
 */
export function AgentThreadView(props: AgentThreadViewProps) {
  const { t } = useText();
  // Resolved once, so the card is built one time for the check and the row.
  const attention = children(() => props.attention);
  const [sending, setSending] = createSignal(false);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  let scroller: HTMLElement | undefined;
  let atEnd = true;
  let shownTaskId = untrack(() => props.task?.id);
  const activityLabel = nextAgentActivityLabel();
  const fades = createScrollFades();
  // The view stays when another thread opens in its place, so each thread opens at its latest message.
  // The effect can run again with the same thread, which must not move the reader.
  createEffect(
    () => props.task?.id,
    (taskId) => {
      if (taskId === shownTaskId) return;
      shownTaskId = taskId;
      atEnd = true;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  );
  onSettled(() => {
    const element = scroller;
    const list = element?.firstElementChild;
    if (!element || !list) return fades.stop;
    const onScroll = () => {
      atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_DISTANCE;
    };
    const follow = new ResizeObserver(() => {
      if (atEnd) element.scrollTop = element.scrollHeight;
    });
    follow.observe(list);
    element.scrollTop = element.scrollHeight;
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      follow.disconnect();
      element.removeEventListener("scroll", onScroll);
      fades.stop();
    };
  });
  let focusedNonce: number | undefined;
  // The thread scrolls to a message once, when its row shows, for example its source after "Branched from".
  createEffect(
    () => ({ focus: props.focusMessage, count: props.messages.length, taskId: props.task?.id }),
    ({ focus }) => {
      if (!focus || focus.nonce === focusedNonce || !scroller) return;
      const message = scroller.querySelector<HTMLElement>(
        `[data-chat-search-message="${CSS.escape(focus.messageId)}"]`,
      );
      const row = message?.closest<HTMLElement>(".virtual-chat-row");
      if (!row) return;
      focusedNonce = focus.nonce;
      atEnd = false;
      row.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      // The same mark as a click on a quote: the row lights up, then fades.
      delete row.dataset.replyFlash;
      void row.offsetWidth;
      row.dataset.replyFlash = "";
      const end = (event: AnimationEvent) => {
        if (event.target !== row || event.animationName !== "reply-flash") return;
        row.removeEventListener("animationend", end);
        delete row.dataset.replyFlash;
      };
      row.addEventListener("animationend", end);
    },
  );
  const active = () => (props.task ? isAgentTaskActive(props.task) : false);
  /** The answers that end a finished turn: each offers a branch. */
  const branchPoints = createMemo(() => branchPointIds(props.messages, props.task?.activeTurnId));
  /** A turn runs, so a branch waits: the backend copies only a thread that does not run. */
  const branchBusy = () => props.task?.activeTurnId != null;
  const branchAction = (message: AgentMessage) => {
    const onBranch = props.onBranch;
    if (!onBranch || !branchPoints().has(message.id)) return undefined;
    return () => onBranch(message.id);
  };
  const title = () => props.task?.title ?? t("conversation.threads.new");
  const placeholder = () =>
    props.task
      ? t("conversation.threads.view.placeholder", { name: props.agent.name, title: props.task.title })
      : t("conversation.threads.view.newPlaceholder", { name: props.agent.name });
  const voicePhase = () => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  /** As in the agent's own chat, nothing sends while the microphone opens or the speech becomes text. */
  const voiceBusy = () => voicePhase() !== "idle" && !recording();
  const send = async () => {
    // As in the agent's own chat, a send while recording sends what was said.
    if (recording()) {
      props.voice?.onSend();
      return;
    }
    const text = props.draft.trim();
    if (!text || sending() || voiceBusy()) return;
    setSending(true);
    try {
      await props.onSend(text);
    } finally {
      setSending(false);
    }
  };
  // An answer from another agent to a request of this thread shows with the name of that agent.
  const author = (message: AgentMessage): ChatMessageAuthor => {
    if (message.author === "you") return { kind: "you", name: t("chat.message.you") };
    const senderId = message.senderAgentId;
    if (senderId === undefined || senderId === props.agent.id)
      return { kind: "agent", name: props.agent.name, agent: props.agent };
    const sender = props.agents.find((candidate) => candidate.id === senderId);
    return {
      kind: "agent",
      name: sender?.name ?? t("chat.message.agentFallback"),
      agent: sender,
      avatarSeed: senderId,
    };
  };
  /** The action row of a message: Copy, and Branch on the last answer of a finished turn. */
  function messageActions(message: AgentMessage): JSX.Element | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming) return undefined;
    return (
      <MessageActions
        message={message}
        authorName={author(message).name}
        reactions={false}
        pickerOpen={false}
        expandedEmoji={false}
        copied={props.copiedMessageId === message.id}
        onTogglePicker={() => undefined}
        onExpandEmoji={() => undefined}
        onReact={() => undefined}
        onCopy={() => onCopy(message)}
        onBranch={branchAction(message)}
        branchDisabled={branchBusy()}
        readAloud={props.readAloud?.(message)}
      />
    );
  }
  /** The right-click menu of a message, with the actions of its action row. */
  function messageMenu(message: AgentMessage): (() => JSX.Element) | undefined {
    const onCopy = props.onCopyMessage;
    if (!onCopy || message.streaming) return undefined;
    return () => (
      <MessageMenu
        message={message}
        authorName={author(message).name}
        reactions={false}
        onReact={() => undefined}
        onCopy={() => onCopy(message)}
        onBranch={branchAction(message)}
        branchDisabled={branchBusy()}
        readAloud={props.readAloud?.(message) ?? props.readAloudOffer?.(message)}
      />
    );
  }
  /** The branch line shows after the last message that the branch copied. */
  function branchDividerAfter(messageId: string): AgentThreadBranchSource | undefined {
    const source = props.branchSource;
    return source?.throughMessageId === messageId ? source : undefined;
  }
  const failed = () => (props.task?.state === "idle" && props.task.outcome === "failed" ? props.task : undefined);
  const running = () =>
    props.task?.state === "running" && !props.approval && !props.waitsForAnswer ? props.task : undefined;
  const queued = () => (props.task && props.task.queuedMessages.length > 0 ? props.task : undefined);
  const hold = () => (props.task ? agentThreadHoldText(props.task, props.limit, t) : null);
  const sendLabel = () => t(recording() ? "composer.send.voice" : "composer.send.message");
  const draftEmpty = () => props.draft.trim().length === 0;
  /** As in the agent's own chat: Send, Send what was said while a recording runs, or Stop while the thread works. */
  const sendButton = () => (
    <ComposerSendControl
      stop={active() && draftEmpty() && !recording()}
      onStop={() => props.onStop()}
      label={sendLabel()}
      disabled={sending() || voiceBusy() || (!recording() && draftEmpty())}
      busy={sending()}
    />
  );
  return (
    <>
      <section
        ref={(element: HTMLElement) => {
          scroller = element;
          fades.bind(element);
          props.scrollRef?.(element);
        }}
        class={["conversation-scroll agent-thread-scroll", fades.classes()]}
        aria-label={t("conversation.threads.view.label", { title: title() })}
        onScroll={fades.measure}
      >
        <div class="virtual-chat-list virtual-chat-list-static" ref={fades.watch}>
          <Show when={props.task?.origin === "agent"}>
            <p class="agent-thread-origin">
              {t("conversation.threads.view.startedByAgent", { name: props.agent.name })}
            </p>
          </Show>
          <For each={props.messages.filter(shownInThread)} keyed={(message) => message.id}>
            {(message) => (
              <div class="virtual-chat-row">
                <Show when={props.stepsAbove?.(message().id)}>
                  {(steps) => (
                    <AgentStepsDisclosure
                      steps={steps()}
                      defaultOpen={props.stepsOpenByDefault ?? false}
                      facts={props.factsAbove?.(message().id)}
                    />
                  )}
                </Show>
                <ChatMessageRow
                  message={message()}
                  author={author(message())}
                  agents={props.agents}
                  skills={props.skills}
                  onSelectAgent={() => undefined}
                  onOpenLink={props.onOpenLink}
                  onPreview={props.onPreview}
                  onAttachmentAction={props.onAttachmentAction}
                  onDownload={(attachment) => props.onAttachmentAction(attachment, "download")}
                  macWindowControls={props.macWindowControls}
                  actions={messageActions(message())}
                  menu={messageMenu(message())}
                  data-chat-search-message={message().id}
                />
                <Show when={branchDividerAfter(message().id)}>{(source) => <BranchDivider source={source()} />}</Show>
              </div>
            )}
          </For>
          <Show when={running()}>
            {(task) => (
              <div class="virtual-chat-row">
                <AgentActivityIndicator
                  agent={props.agent}
                  label={activityLabel}
                  detail={task().progress}
                  steps={props.activeSteps}
                  stepsOpenByDefault={props.stepsOpenByDefault}
                />
              </div>
            )}
          </Show>
          <Show keyed when={props.approval}>
            {(approval) => (
              <div class="virtual-chat-row">
                <ApprovalCard
                  approval={approval}
                  agentName={props.agent.name}
                  onApprove={() => props.onRespondApproval("accept")}
                  onReject={() => props.onRespondApproval("decline")}
                />
              </div>
            )}
          </Show>
          <Show when={attention.toArray().length > 0}>
            <div class="virtual-chat-row">{attention()}</div>
          </Show>
          <Show when={hold()}>
            {(text) => (
              <div class="virtual-chat-row">
                <p class="agent-queue-hold" role="status">
                  {text()}
                </p>
              </div>
            )}
          </Show>
          <Show when={props.queue ? undefined : queued()}>
            {(task) => (
              <section class="agent-thread-queued" aria-label={t("conversation.threads.view.queued")}>
                <For each={task().queuedMessages} keyed={(message) => message.deliveryId}>
                  {(message) => <p class="agent-thread-queued-text">{message().text}</p>}
                </For>
              </section>
            )}
          </Show>
        </div>
      </section>
      <div class="composer-wrap">
        {props.aboveComposer}
        <Show when={failed()}>
          {(task) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.threads.view.failed")}
              body={task().error || t("conversation.threads.view.failedBody")}
            />
          )}
        </Show>
        <Show when={props.queue ? queued() : undefined}>
          {(task) => (
            <div class="composer-stack">
              <div class="agent-queue-slot" data-open="true">
                <div class="agent-queue-slot-inner">
                  <Loading>
                    <QueuePanel
                      deliveries={queueDeliveries(task(), props.agent.id)}
                      canSteer={task().activeTurnId !== null}
                      onSteer={props.queue?.onSteer}
                      onCancel={(deliveryId) => props.queue?.onCancel(deliveryId)}
                      onReorder={(deliveryIds) => props.queue?.onReorder(deliveryIds)}
                    />
                  </Loading>
                </div>
              </div>
            </div>
          )}
        </Show>
        <form
          class="composer agent-thread-composer"
          data-compact="true"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent.id}
              agents={props.agents}
              skills={props.skills}
              skillsLoadFailed={props.skillsLoadFailed}
              mcpServers={props.mcpServers}
              attachments={props.draftAttachments}
              value={props.draft}
              placeholder={placeholder()}
              ariaLabel={placeholder()}
              focusRequest={props.focusRequest}
              skillPickerRequest={skillPickerRequest()}
              dictation={{ text: props.voice?.liveText ?? "", final: voicePhase() === "transcribing" }}
              disabled={sending() || voicePhase() === "transcribing"}
              sendShortcut={props.sendShortcut}
              onSubmit={() => void send()}
              onValueChange={props.onDraftChange}
              onPasteFiles={props.onPasteFiles}
              onOpenAttachment={props.onOpenDraftAttachment}
            />
          </div>
          <div class="composer-toolbar">
            <ComposerAddMenu
              open={addMenuOpen()}
              onOpenChange={setAddMenuOpen}
              disabled={sending() || voicePhase() === "transcribing"}
              onAttach={props.onAttachFiles}
              onPickSkill={() => setSkillPickerRequest((current) => current + 1)}
              onSideQuestion={props.onSideQuestion}
            />
            <div class="composer-primary-actions">
              {/* One meter for each thread: a pending Compact or an open popover stays with its thread. */}
              <Show when={props.task?.id} keyed>
                {(_taskId) => (
                  <Show when={props.context}>
                    {(usage) => <ContextUsageMeter usage={usage()} compact={props.onCompactContext} />}
                  </Show>
                )}
              </Show>
              <Show when={props.voice} fallback={sendButton()}>
                {(voice) => (
                  <ComposerVoiceControls
                    phase={voice().phase}
                    levels={voice().levels}
                    elapsedSeconds={voice().elapsedSeconds}
                    modelProgress={voice().modelProgress}
                    blocked={voice().blocked || sending()}
                    onStart={() => voice().onStart()}
                    onCancel={() => voice().onCancel()}
                    onFinish={() => voice().onFinish()}
                    send={sendButton()}
                  />
                )}
              </Show>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
