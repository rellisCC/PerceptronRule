// Sample dataset used when the dropdown selects "Sample Dataset".
window.SAMPLE_DATASET = {
  dataContextName: "PerceptronSample",
  title: "Perceptron Sample Data",
  collectionName: "Cases",
  attrs: [
    { name: "x", type: "numeric" },
    { name: "y", type: "numeric" },
    { name: "Sentiment", type: "numeric", precision: 0 }
  ],
  cases: [
    { values: { x:  1, y:  2, Sentiment: -1 } },
    { values: { x:  2, y:  1, Sentiment:  1 } },
    { values: { x: -1, y:  1, Sentiment:  1 } },
    { values: { x: -2, y: -1, Sentiment: -1 } },
    { values: { x:  0, y:  0, Sentiment: -1 } },
    { values: { x:  3, y: -1, Sentiment:  1 } },
    { values: { x: -1, y:  3, Sentiment:  1 } },
    { values: { x:  1, y: -2, Sentiment: -1 } }
  ]
};
