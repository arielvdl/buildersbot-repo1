### Added

- Add "Force now" to the messages that wait in a quick chat conversation. It stops
  the turn that runs in that thread and starts the message next, alone, with the same question and the
  same "Don’t ask me about this again" choice as the chat. It works with every provider, also those that cannot
  steer a running turn, such as Cultura Builder. A turn in another conversation keeps running.
  Only this computer can do it: the Team API still forces only the messages of an agent's own chat.
