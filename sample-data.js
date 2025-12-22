window.SAMPLE_DATASETS = [
  {
    name: "Sample Dataset",
    attrs: [
      { name: "ID" },
      { name: "Text" },
      { name: "Cbest" },
      { name: "Cbad" },
      { name: "Sentiment" }
    ],
    cases: [
      { ID:"RA", Text:"You know the pizza place is bad when even the breadsticks are bad.", Cbest:0, Cbad:2, Sentiment:-1 },
      { ID:"RB", Text:"I had a bad experience at Mama’s pizza when I ordered pepperoni but they delivered pineapple", Cbest:0, Cbad:1, Sentiment:-1 },
      { ID:"RC", Text:"I had the best birthday ever since I got to eat the best pizza from Mama’s.", Cbest:2, Cbad:0, Sentiment: 1 },
      { ID:"RD", Text:"Even though this is in the best location, the management is simply bad.", Cbest:1, Cbad:1, Sentiment:-1 },
      { ID:"RE", Text:"Mama’s has the best pizza in Pittsburg, if not the entire country.", Cbest:1, Cbad:0, Sentiment: 1 },
      { ID:"RF", Text:"Whenever I am having a bad day, I come to the best place, Mama’s, because the pizza and vibe is simply the best.", Cbest:2, Cbad:1, Sentiment: 1 },
      { ID:"RG", Text:"I love eating at Mama’s pizza place!", Cbest:0, Cbad:0, Sentiment: 1 },
      { ID:"RH", Text:"With the bad smell and the bad flavors, I would challenge anyone to consider this place to be good, let alone the best.", Cbest:1, Cbad:2, Sentiment:-1 },
      { ID:"RI", Text:"If you want the best, definitely don’t come here! The pizza is bad, the location is bad, and the idea that this is the best pizza place is truly laughable.", Cbest:2, Cbad:2, Sentiment:-1 }
    ]
  }
];
