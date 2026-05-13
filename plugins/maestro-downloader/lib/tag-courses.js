#!/usr/bin/env node
/**
 * Applies contentType tags to courses in index.json.
 * Run after fix-index.js. Safe to re-run; only updates untagged or default-tagged courses.
 *
 * Content types:
 *   default  — general instructional (writing, business, lifestyle)
 *   music    — audio fidelity critical (music production, singing, musical theatre)
 *   visual   — high visual detail (photography, painting, filmmaking, design, floristry, mixology)
 *   lean     — audio-primary; visuals barely matter (breathwork, wellness, lectures, comedy)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { atomicWriteJson } from './index-utils.js';

const ENV_PATH = join(homedir(), '.claude', 'plugins', 'maestro-downloader', '.env');

const TAGS = {
  // music — audio fidelity critical
  'mark-ronson/music-production': 'music',
  'eric-vetro/singing': 'music',
  'sir-tim-rice/writing-and-performing-musical-theatre': 'music',

  // visual — high visual detail matters
  'rankin/an-introduction-to-photography': 'visual',
  'edgar-wright/filmmaking': 'visual',
  'paula-scher/graphic-design': 'visual',
  'beata-heuman/interior-design': 'visual',
  'jonathan-yeo/portrait-painting': 'visual',
  'simon-lycett/decorating-with-flowers': 'visual',
  'ago-perrone/mastering-mixology': 'visual',
  'brian-cox/acting': 'visual',
  'steve-mann/dog-training': 'visual',
  'richard-bertinet/bread-making': 'visual',
  'jancis-robinson/an-understanding-of-wine': 'visual',
  'marco-pierre-white/delicious-food-cooked-simply': 'visual',
  'vineet-bhatia/modern-indian-cooking': 'visual',
  'pierre-koffmann/classic-french-bistro-cooking': 'visual',
  'gary-barlow/songwriting': 'music',
  'marco-pierre-white/delicious-vegetarian-cooking': 'visual',
  'david-walliams/writing-books-for-children': 'default',
  'malorie-blackman/writing-for-young-adults': 'default',

  // lean — audio-primary; visuals barely matter
  'owen-o-kane/a-life-less-anxious': 'lean',
  'james-nestor/the-power-of-your-breath': 'lean',
  'dr-rangan-chatterjee/a-blueprint-for-healthy-living': 'lean',
  'stephanie-romiszewski/sleep-better': 'lean',
  'mo-gawdat/happiness': 'lean',
  'oliver-burkeman/time-management': 'lean',
  'richard-greene/public-speaking-and-communication': 'lean',
  'evy-poumpouras/the-art-of-influence': 'lean',
  'steven-bartlett/start-and-scale-a-business': 'lean',
  'peter-jones/toolkit-for-business-success': 'lean',
  'trinny-woodall/thriving-in-business': 'lean',
  'jo-malone-cbe/think-like-an-entrepreneur': 'lean',
  'doreen-lawrence/finding-the-inner-strength': 'lean',

  // default — general instructional (writing, storytelling, cooking, general lifestyle)
  'agatha-christie/writing': 'default',
  'jojo-moyes/writing-love-stories': 'default',
  'ken-follett/writing-bestselling-fiction': 'default',
  'carol-ann-duffy/writing-poetry': 'default',
  'lee-child/writing-popular-fiction': 'default',
  'sir-billy-connolly/comedy': 'default',
  'alan-moore/storytelling': 'default',
  'julia-donaldson/writing-children-s-picture-books': 'default',
  'jed-mercurio/writing-drama-for-television': 'default',
  'bill-lawrence/writing-comedy-for-television': 'default',
  'harlan-coben/writing-thrillers': 'default',
  'isabel-allende/magical-storytelling': 'default',
  'marina-abramovic/the-art-of-being-present': 'default',
  'professor-tim-spector/the-science-of-eating-well': 'default',
};

async function main() {
  dotenvConfig({ path: ENV_PATH, override: false });
  const root = process.env.MAESTRO_ROOT?.trim();
  if (!root) { console.error('MAESTRO_ROOT not set'); process.exit(1); }

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) { console.error('No index.json found'); process.exit(1); }

  const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
  let tagged = 0;
  let unrecognised = [];

  for (const course of indexData.courses) {
    const explicit = TAGS[course.slug];
    if (explicit) {
      course.contentType = explicit;
      tagged++;
    } else if (!course.contentType || course.contentType === 'default') {
      course.contentType = 'default';
      unrecognised.push(course.slug);
    }
  }

  await atomicWriteJson(indexPath, indexData);

  console.log(`Tagged ${tagged} courses explicitly.`);
  if (unrecognised.length > 0) {
    console.log(`\nThe following courses defaulted to 'default' — review and add to TAGS if needed:`);
    unrecognised.forEach(s => console.log(`  ${s}`));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
