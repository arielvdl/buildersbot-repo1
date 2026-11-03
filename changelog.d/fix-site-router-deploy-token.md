### Fixed

- The production deploy no longer stops when the optional site-router token is absent: it falls back
  to the production deploy token, which already has the Worker and zone permissions.
