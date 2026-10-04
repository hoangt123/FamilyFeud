// Loads and validates content packs from the packs/ directory.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config/index.js';
import { FAST_MONEY, SURVEY } from '../shared/protocol.js';

function validateSurveyPack(pack, file) {
  const errors = [];
  if (!pack.id) errors.push('missing "id"');
  if (!Array.isArray(pack.surveys) || pack.surveys.length === 0) errors.push('missing "surveys"');
  for (const s of pack.surveys ?? []) {
    if (!s.prompt) errors.push('a survey is missing "prompt"');
    const n = Array.isArray(s.answers) ? s.answers.length : 0;
    if (n < SURVEY.MIN_ANSWERS || n > SURVEY.MAX_ANSWERS)
      errors.push(`survey "${s.prompt}" must have ${SURVEY.MIN_ANSWERS}–${SURVEY.MAX_ANSWERS} answers`);
    for (const a of s.answers ?? []) {
      if (!a.text || !Number.isFinite(a.points) || a.points <= 0)
        errors.push(`an answer in "${s.prompt}" needs "text" and positive "points"`);
    }
  }
  return errors.map((e) => `${file}: ${e}`);
}

// A Fast Money pack is a pool of questions: a flat "questions" list, and/or
// the Quiz Clash "sets" format, whose sets are simply merged into the pool.
function fastMoneyQuestions(pack) {
  const fromSets = Array.isArray(pack.sets) ? pack.sets.flatMap((s) => s.questions ?? []) : [];
  return [...(Array.isArray(pack.questions) ? pack.questions : []), ...fromSets];
}

function validateFastMoneyPack(pack, file) {
  const errors = [];
  const questions = fastMoneyQuestions(pack);
  if (!questions.length) errors.push('missing "questions"');
  for (const q of questions) {
    if (!q.prompt || !Array.isArray(q.answers) || q.answers.length === 0)
      errors.push('a question is missing "prompt" or "answers"');
  }
  return errors.map((e) => `${file}: ${e}`);
}

// Loads everything under packs/. Returns { surveyPacks, fastMoney, warnings },
// where fastMoney is the pooled list of every Fast Money question.
export async function loadPacks(dir = config.paths.packs) {
  const warnings = [];
  const surveyPacks = [];
  const fastMoneyPool = [];
  const seenPrompts = new Set();

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    warnings.push(`Could not read packs directory: ${err.message}`);
    return { surveyPacks, fastMoney: fastMoneyPool, warnings };
  }

  for (const file of files.sort()) {
    let pack;
    try {
      pack = JSON.parse(await readFile(join(dir, file), 'utf8'));
    } catch (err) {
      warnings.push(`${file}: invalid JSON — ${err.message}`);
      continue;
    }

    if (pack.kind === 'fast-money') {
      const errs = validateFastMoneyPack(pack, file);
      if (errs.length) {
        warnings.push(...errs);
        continue;
      }
      for (const q of fastMoneyQuestions(pack)) {
        const key = q.prompt.trim().toLowerCase();
        if (seenPrompts.has(key)) continue; // the same question in two packs counts once
        seenPrompts.add(key);
        fastMoneyPool.push({ prompt: q.prompt, topic: q.topic || '', answers: q.answers });
      }
    } else {
      const errs = validateSurveyPack(pack, file);
      if (errs.length) {
        warnings.push(...errs);
        continue;
      }
      const title = pack.title || pack.id;
      surveyPacks.push({
        id: pack.id,
        title,
        surveys: pack.surveys.map((s) => ({
          prompt: s.prompt,
          packId: pack.id,
          // The board always lists answers from most to least popular.
          answers: [...s.answers]
            .sort((a, b) => b.points - a.points)
            .map((a) => ({ text: a.text, points: a.points, accept: Array.isArray(a.accept) ? a.accept : [] })),
        })),
      });
    }
  }

  if (fastMoneyPool.length && fastMoneyPool.length < FAST_MONEY.QUESTION_COUNT)
    warnings.push(`Fast Money needs at least ${FAST_MONEY.QUESTION_COUNT} questions; found ${fastMoneyPool.length}`);
  return { surveyPacks, fastMoney: fastMoneyPool, warnings };
}
