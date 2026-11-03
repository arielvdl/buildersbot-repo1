### Fixed

- Published sites answer on the current one-label host (`<slug>.culturabuilder.com`): the site router
  declares the wildcard route again, and the deploy smoke check uses that shape instead of the old
  `sites.` subdomain.
