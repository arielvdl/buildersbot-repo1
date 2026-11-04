### Added

- On a joined server, including a server on this computer, the sidebar now has the same section tools as
  on the local server: section color, section icon, markers, and reordering the sections in the section
  rail. The host sends them through the new optional `sidebar-style-v1` capability. A server that does
  not have it keeps the old sidebar, and the released sidebar routes do not change.
