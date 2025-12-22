// Sample dataset used when the dropdown selects "Sample Dataset".
// Cbest = count of "best" tokens; Cbad = count of "bad" tokens.
// Sentiment: +1 = positive, -1 = negative.
window.SAMPLE_DATASET = {
  dataContextName: "PerceptronSample",
  title: "Perceptron Sample Data (Mama's Pizza)",
  collectionName: "Reviews",
  attrs: [
    { name: "ID", type: "categorical" },
    { name: "Text", type: "categorical" },
    { name: "Cbest", type: "numeric", precision: 0 },
    { name: "Cbad", type: "numeric", precision: 0 },
    { name: "Sentiment", type: "numeric", precision: 0 }
  ],
  // Rows are in the order you provided (RA..RI)
  cases: [
    { values: { ID:"RA", Text:"You know the pizza place is bad when even the breadsticks are bad.", Cbest:0, Cbad:2, Sentiment:-1 } },
    { values: { ID:"RB", Text:"I had a bad experience at Mama’s pizza when I ordered pepperoni but they delivered pineapple", Cbest:0, Cbad:1, Sentiment:-1 } },
    { values: { ID:"RC", Text:"I had the best birthday ever since I got to eat the best pizza from Mama’s.", Cbest:2, Cbad:0, Sentiment: 1 } },
    { values: { ID:"RD", Text:"Even though this is in the best location, the management is simply bad.", Cbest:1, Cbad:1, Sentiment:-1 } },
    { values: { ID:"RE", Text:"Mama’s has the best pizza in Pittsburg, if not the entire country.", Cbest:1, Cbad:0, Sentiment: 1 } },
    { values: { ID:"RF", Text:"Whenever I am having a bad day, I come to the best place, Mama’s, because the pizza and vibe is simply the best.", Cbest:2, Cbad:1, Sentiment: 1 } },
    { values: { ID:"RG", Text:"I love eating at Mama’s pizza place!", Cbest:0, Cbad:0, Sentiment: 1 } },
    { values: { ID:"RH", Text:"With the bad smell and the bad flavors, I would challenge anyone to consider this place to be good, let alone the best.", Cbest:1, Cbad:2, Sentiment:-1 } },
    { values: { ID:"RI", Text:"If you want the best, definitely don’t come here! The pizza is bad, the location is bad, and the idea that this is the best pizza place is truly laughable.", Cbest:2, Cbad:2, Sentiment:-1 } }
  ]
};
