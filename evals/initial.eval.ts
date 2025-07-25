import { evalite } from "evalite";
import { askDeepSearch } from "~/deep-search";
import { env } from "~/env";

import { AnswerRelevancy } from "./answer-relevancy-scorer";
import { ciData } from "./ci";
import { devData } from "./dev";
import { Factuality } from "./factuality-scorer";
import { regressionData } from "./regression";

const data = [...devData];

// If CI, add the CI data
if (env.EVAL_DATASET === "ci") {
  data.push(...ciData);
  // If Regression, add the regression data AND the CI data
} else if (env.EVAL_DATASET === "regression") {
  data.push(...ciData, ...regressionData);
}

evalite("Deep Search Eval", {
  data: () => data,
  task: async (input) => {
    return askDeepSearch(input);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Regex pattern to match markdown links: [text](url)
        const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkPattern.test(output);

        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
    AnswerRelevancy,
  ],
});
