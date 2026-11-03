### Fixed

- A change in the queue of an agent no longer reads the whole mailbox to find the Quick chat questions that wait for
  it. Before, each of these changes scanned every delivery and indexed every message for it, in each agent, also with
  no Quick chat conversation open. The Quick chat tasks now remember which agents they asked, so the check is a lookup.
