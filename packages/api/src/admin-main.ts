import { Firestore } from '@google-cloud/firestore';
import { admin } from './admin.ts';
import { FirestoreStore } from './firestore-store.ts';

// Runs on the laptop of the owner after `gcloud auth application-default login`,
// with GOOGLE_CLOUD_PROJECT set. See DEPLOY.md.
const store = new FirestoreStore(new Firestore());
process.exitCode = await admin(process.argv.slice(2), store, (s) => process.stdout.write(s));
