### Fixed

- On a Mac, the memory level now counts the macOS compressor. Before, a Mac with 9.5 GB compressed still
  read 65% free, so no turn was held. At 35% of the memory compressed the level is low, and at 55% it is
  critical.
- A session counts as 560 MB, the measured cost, in place of 300 MB. No extra channel tab starts while the
  level is low or critical.
