### Fixed

- A long session keeps less memory in the chat. The raw text of a message that leaves an inactive
  conversation is now freed, and each conversation keeps only its newest 20 different errors.
