### Added

- Each Quick chat conversation has its own model. Choose a model in one conversation, and the other
  conversations keep theirs. A new conversation starts with the model of the last conversation you
  used. A model change applies from your next message in that conversation. It does not stop a reply
  that is already running, and it does not change the other conversations.
- An older version of Builders Bot ignores the model of each conversation. It runs every Quick chat
  conversation on the model of the Quick chat agent.

### Fixed

- The model picker in Quick chat no longer closes or flickers while another conversation runs. Before,
  it could close while you chose a model.
- A model you chose in Quick chat no longer changes back to the old model when you send your next
  message. Before, the message could run on the old model.
