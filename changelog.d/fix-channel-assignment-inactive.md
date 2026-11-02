### Fixed

- A member whose channel task was stopped, replaced or restarted no longer shows the error "The channel
  assignment is no longer active". It now ends its turn quietly. A channel tool call that comes just
  before the turn is linked to its task waits a short time instead of failing.
