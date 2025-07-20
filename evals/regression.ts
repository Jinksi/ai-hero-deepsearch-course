import type { Message } from "ai";

export const regressionData: { input: Message[]; expected: string }[] = [
  {
    input: [
      {
        id: "5",
        role: "user",
        content:
          "Is there a desktop-unit hardware version of the Take-5, what is it called and does it include tape delay?",
      },
    ],
    expected:
      "There is a desktop module version of the Take-5. It does include tape delay.",
  },
];