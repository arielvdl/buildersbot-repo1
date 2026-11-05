### Fixed

- The Mac app is signed and checked with the Cultura Builder Apple team (HCT8F2D969), the team that
  holds the Developer ID certificates. Before, the code expected another team, so a build signed with
  the certificates could not pass the package check. The iPhone app keeps its own team in the
  universal links file.
