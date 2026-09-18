import type { Rule } from './types.js';

export function selectSound(rule: Rule, random: () => number = Math.random): string {
  if (!rule.sounds) {
    if (!rule.sound) throw new Error('Rule has no sound configured.');
    return rule.sound;
  }

  const sounds = rule.sounds.filter((entry) => entry.weight > 0);
  const totalWeight = sounds.reduce((total, entry) => total + entry.weight, 0);
  const target = random() * totalWeight;
  let cumulativeWeight = 0;

  for (const entry of sounds) {
    cumulativeWeight += entry.weight;
    if (target < cumulativeWeight) return entry.sound;
  }

  return sounds[sounds.length - 1].sound;
}