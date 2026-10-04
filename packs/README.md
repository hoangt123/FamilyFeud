# Survey packs

Every `.json` file in this folder is loaded at startup. Problems are printed as
warnings and that pack is skipped, so a typo never stops the server.

## Survey packs (main rounds)

```jsonc
{
  "id": "everyday-life",          // unique, used to toggle the pack in the lobby
  "title": "Everyday Life",
  "surveys": [
    {
      "prompt": "Name something people do as soon as they wake up.",
      "answers": [
        // 3–8 answers. Order doesn't matter; the board sorts by points.
        { "text": "Check their phone", "points": 31, "accept": ["phone", "scroll"] },
        { "text": "Go to the bathroom", "points": 22 }
      ]
    }
  ]
}
```

- `text` is what the tile shows; `points` must be positive (the real show's add up
  to at most 100).
- `accept` lists other ways people might say it. Matching already ignores case,
  punctuation, "a/an/the" and small typos, and a response containing the whole
  answer word counts ("my phone" → *phone*), so only add true synonyms.

## Fast Money packs

Fast Money uses the same format as [Quiz Clash](https://github.com/hoangt123/Jeopardy):
`"kind": "fast-money"` and a list of `sets`, each with exactly **5** questions.
One set is picked at random each game.

```jsonc
{
  "id": "fast-money",
  "kind": "fast-money",
  "sets": [
    {
      "questions": [
        {
          "prompt": "Name a popular pizza topping.",
          "answers": [{ "text": "Pepperoni", "points": 40, "accept": ["pepperoni"] }]
        }
        // …×5
      ]
    }
  ]
}
```
