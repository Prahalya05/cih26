// Plays the demo stories on the phone (data in storyData.ts).

import type { EvidenceEvent } from "@disha/engine";
import { db, type StoredEvent } from "./db";
import { refreshSkillState } from "./skills";
import { DEVICE, storyEvents, type StoryStep } from "./storyData";

export { STORIES, type StoryStep } from "./storyData";

const asStored = (evs: EvidenceEvent[]): StoredEvent[] => evs.map((e) => ({ ...e, synced: 1 as const }));

/** Adds the whole story at once (used when the demo class is loaded). */
export async function addStory(studentId: string, steps: StoryStep[]): Promise<void> {
  await db.events.bulkPut(asStored(storyEvents(studentId, steps).flat()));
  await refreshSkillState(studentId);
}

let playing: string | null = null;

/** The step being replayed right now, shown as a banner on the Strengths tab. */
export const STORY_KEY = "story_step";

/**
 * Replays a demo student's story: removes the story events, then adds them back one step at a time with a
 * pause, so the Strengths tab shows the level rising. onStep reports which step is showing.
 */
export async function playStory(studentId: string, steps: StoryStep[], onStep?: (i: number) => void, pauseMs = 2500) {
  if (playing) return;
  playing = studentId;
  try {
    const all = await db.events.where("student_id").equals(studentId).toArray();
    await db.events.bulkDelete(all.filter((e) => e.device_id === DEVICE).map((e) => e.id));
    await refreshSkillState(studentId);
    const batches = storyEvents(studentId, steps);
    for (let i = 0; i < batches.length; i++) {
      await new Promise((r) => setTimeout(r, pauseMs));
      onStep?.(i);
      await db.meta.put({ key: STORY_KEY, value: { student: studentId, step: i, of: steps.length, label: steps[i].label } });
      await db.events.bulkPut(asStored(batches[i]));
      await refreshSkillState(studentId);
    }
    await new Promise((r) => setTimeout(r, pauseMs));
  } finally {
    playing = null;
    await db.meta.delete(STORY_KEY);
  }
}
