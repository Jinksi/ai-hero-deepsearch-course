import type { Message } from "ai";

export const ciData: { input: Message[]; expected: string }[] = [
  {
    input: [
      {
        id: "3",
        role: "user",
        content:
          "What is the latest Ableton Move stable software version, and what changes are included in the latest version?",
      },
    ],
    expected: `The latest Ableton Move stable software version is 1.5.1.
Released on June 19, 2025.
It includes a bugfix:
Drum Sampler's Pitch > Env parameter is now on by default when loading or recording a sample.`,
  },
  {
    input: [
      {
        id: "4",
        role: "user",
        content:
          "What is Rival Console's latest album, and what DAW was used to create it?",
      },
    ],
    expected:
      "Rival Console's latest album is 'Landscape from Memory'. It was created using the Ableton Live DAW.",
  },
];