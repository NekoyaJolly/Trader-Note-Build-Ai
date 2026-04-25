/**
 * Phase 6.7c: ファイル上のプロンプトを PromptRegistry の active に同期する。
 *
 * seed.ts は既存 active があると skip するため、6.7c の文面更新を DB active に
 * 反映するには本スクリプトを使う。既存 active は promote() により deprecated として残す。
 *
 * 実行:
 *   npx tsx src/side-b/prompts/registry/syncActiveFromFiles.ts
 */

import fs from 'fs';
import path from 'path';
import { PromptRegistry } from './PromptRegistry';
import { DEFAULT_SEED_ENTRIES, type SeedEntry } from './seed';

export interface SyncPromptResult {
  promoted: string[];
  insertedActive: string[];
  unchanged: string[];
  missingFiles: string[];
}

function makeVersionPrefix(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `phase-6.7c-${stamp}`;
}

export async function syncActivePromptsFromFiles(
  entries: SeedEntry[] = DEFAULT_SEED_ENTRIES,
  registry: PromptRegistry = new PromptRegistry(),
  promptsDir: string = path.resolve(__dirname, '..'),
): Promise<SyncPromptResult> {
  const result: SyncPromptResult = {
    promoted: [],
    insertedActive: [],
    unchanged: [],
    missingFiles: [],
  };
  const versionPrefix = makeVersionPrefix();

  for (const entry of entries) {
    const filePath = path.join(promptsDir, entry.file);
    if (!fs.existsSync(filePath)) {
      result.missingFiles.push(filePath);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const active = await registry.getActive(entry.agentName);
    if (!active) {
      await registry.register({
        agentName: entry.agentName,
        version: `${versionPrefix}-initial`,
        content,
        createdBy: 'human',
        status: 'active',
        notes: `Phase 6.7c active sync: ${entry.file}`,
      });
      result.insertedActive.push(entry.agentName);
      continue;
    }

    if (active.content === content) {
      result.unchanged.push(entry.agentName);
      continue;
    }

    const experimental = await registry.register({
      agentName: entry.agentName,
      version: `${versionPrefix}-sync`,
      content,
      parentVersionId: active.id,
      createdBy: 'human',
      status: 'experimental',
      notes: `Phase 6.7c active sync from ${entry.file}`,
    });
    await registry.promote(experimental.id, {
      approvedBy: 'neko',
      notes: `Phase 6.7c active sync from ${entry.file}`,
    });
    result.promoted.push(entry.agentName);
  }

  return result;
}

async function main(): Promise<void> {
  const result = await syncActivePromptsFromFiles();
  console.log(
    `[prompt-sync] promoted=${result.promoted.length} insertedActive=${result.insertedActive.length} unchanged=${result.unchanged.length} missing=${result.missingFiles.length}`,
  );
  if (result.promoted.length > 0) {
    console.log(`[prompt-sync] promoted: ${result.promoted.join(', ')}`);
  }
  if (result.insertedActive.length > 0) {
    console.log(`[prompt-sync] inserted active: ${result.insertedActive.join(', ')}`);
  }
  if (result.unchanged.length > 0) {
    console.log(`[prompt-sync] unchanged: ${result.unchanged.join(', ')}`);
  }
  if (result.missingFiles.length > 0) {
    console.warn(`[prompt-sync] missing files:\n  - ${result.missingFiles.join('\n  - ')}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[prompt-sync] failed:', err);
    process.exit(1);
  });
}
