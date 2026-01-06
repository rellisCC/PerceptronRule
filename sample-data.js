window.SAMPLE_DATASETS = [
  {
    name: "Sample Dataset",
    attrs: [
      { name: "ID" },
      { name: "Text" },
      { name: "feat1: Cbest" },
      { name: "feat2: Cbad" },
      { name: "label: Sentiment" }
    ],
    cases: [
      { ID:"RA", Text:"You know the pizza place is bad when even the breadsticks are bad.", feat1:0, feat2:2, label:-1 },
      { ID:"RB", Text:"I had a bad experience at Mama’s pizza when I ordered pepperoni but they delivered pineapple", feat1:0, feat2:1, label:-1 },
      { ID:"RC", Text:"I had the best birthday ever since I got to eat the best pizza from Mama’s.", feat1:2, feat2:0, label: 1 },
      { ID:"RD", Text:"Even though this is in the best location, the management is simply bad.", feat1:1, feat2:1, label:-1 },
      { ID:"RE", Text:"Mama’s has the best pizza in Pittsburg, if not the entire country.", feat1:1, feat2:0, label: 1 },
      { ID:"RF", Text:"Whenever I am having a bad day, I come to the best place, Mama’s, because the pizza and vibe is simply the best.", feat1:2, feat2:1, label: 1 },
      { ID:"RG", Text:"I love eating at Mama’s pizza place!", feat1:0, feat2:0, label: 1 },
      { ID:"RH", Text:"With the bad smell and the bad flavors, I would challenge anyone to consider this place to be good, let alone the best.", feat1:1, feat2:2, label:-1 },
      { ID:"RI", Text:"If you want the best, definitely don’t come here! The pizza is bad, the location is bad, and the idea that this is the best pizza place is truly laughable.", feat1:2, feat2:2, label:-1 }
    ]
  }
];
