import { Firestore } from '@google-cloud/firestore';
import { describe, it } from 'vitest';
import { FirestoreStore } from './firestore-store.ts';
import { storeContract } from './store-contract.ts';

// Runs only on the Firestore emulator (FIRESTORE_EMULATOR_HOST), never on a real project.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  storeContract('firestore', async () => new FirestoreStore(new Firestore({ projectId: 'legal-lint-test' })));
} else {
  describe('firestore store', () => {
    it.skip('needs FIRESTORE_EMULATOR_HOST (see DEPLOY.md, "Testing the Firestore store")', () => {});
  });
}
