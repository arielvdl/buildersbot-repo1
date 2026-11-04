### Changed

- A long chat now compacts at 500,000 tokens. Before, a chat on a model with a window of 1 million
  tokens compacted at 800,000 to 890,000 tokens, or never. The model window stays at 1 million.
- The context ring turns to the warning colour from 400,000 tokens, and its panel says that each
  turn sends the whole chat again.
