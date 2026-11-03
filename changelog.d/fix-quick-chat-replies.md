### Fixed

- An agent that the Quick chat asked can answer it with `send_message`. Before, the answer was refused as an
  unknown agent, because the Quick chat agent is in no list. Now the Quick chat takes the answer to a question that
  it sent from an open conversation, one time, and the answer shows in that conversation. Any other message to
  it, and every list, tool and the Team API, still do not find it.
