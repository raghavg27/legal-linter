import {
  LineMap,
  calleeText,
  fileKind,
  importsOf,
  isNonShippingFile,
  lineRange,
  ts,
  walk,
  type RepoIndex,
  type StaticEvidence,
} from '@legal-lint/core';

// Upload handlers from the rulebook (multer, formidable, S3 presigned URLs,
// UploadThing, Cloudinary), and the storage SDKs that are frequent in the target stack.

const HINT = /multer|formidable|busboy|uploadthing|cloudinary|presign|getSignedUrl|PutObjectCommand|@vercel\/blob|\.storage\b|firebase\/storage/i;

const CALL_BY_IMPORT: Record<string, { names: string[]; label: string }> = {
  multer: { names: ['default'], label: 'multer upload middleware' },
  formidable: { names: ['default', 'formidable', 'IncomingForm', 'Formidable'], label: 'formidable upload parser' },
  busboy: { names: ['default'], label: 'busboy upload parser' },
  'uploadthing/next': { names: ['createUploadthing'], label: 'UploadThing file router' },
  'uploadthing/server': { names: ['createUploadthing'], label: 'UploadThing file router' },
  'uploadthing/express': { names: ['createUploadthing'], label: 'UploadThing file router' },
  '@uploadthing/react': { names: ['generateUploadButton', 'generateUploadDropzone'], label: 'UploadThing upload component' },
  '@aws-sdk/s3-presigned-post': { names: ['createPresignedPost'], label: 'S3 presigned upload' },
  '@vercel/blob': { names: ['put'], label: 'Vercel Blob upload' },
  '@vercel/blob/client': { names: ['upload', 'handleUpload'], label: 'Vercel Blob client upload' },
  'firebase/storage': { names: ['uploadBytes', 'uploadBytesResumable', 'uploadString'], label: 'Firebase Storage upload' },
};

const JSX_BY_IMPORT: Record<string, { names: string[]; label: string }> = {
  '@uploadthing/react': { names: ['UploadButton', 'UploadDropzone'], label: 'UploadThing upload component' },
  'next-cloudinary': { names: ['CldUploadWidget', 'CldUploadButton'], label: 'Cloudinary upload widget' },
};

function sitesIn(sf: ts.SourceFile): { startLine: number; endLine: number; observed: string }[] {
  const imports = importsOf(sf);
  const sites: { startLine: number; endLine: number; observed: string }[] = [];
  const text = sf.getFullText();
  const putsObjects = /PutObjectCommand|['"]putObject['"]/.test(text);

  walk(sf, (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = calleeText(sf, node);
      const root = callee.split('.')[0]!;
      const binding = imports.get(root);
      const byImport = binding && CALL_BY_IMPORT[binding.module];
      if (byImport && byImport.names.includes(binding.imported) && !callee.includes('.')) {
        sites.push({ ...lineRange(sf, node), observed: byImport.label });
        return;
      }
      if (/\.uploader\.(upload|upload_stream|upload_large)$/.test(callee) || /(^|\.)createUploadWidget$/.test(callee)) {
        sites.push({ ...lineRange(sf, node), observed: 'Cloudinary upload' });
        return;
      }
      if (/\.storage\.from\(.*\)\.(upload|uploadToSignedUrl|createSignedUploadUrl)$/.test(callee)) {
        sites.push({ ...lineRange(sf, node), observed: 'Supabase Storage upload' });
        return;
      }
      if (/(^|\.)getSignedUrl$/.test(callee) && putsObjects) {
        sites.push({ ...lineRange(sf, node), observed: 'S3 presigned upload URL' });
      }
      return;
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(sf);
      const binding = imports.get(tag);
      const byImport = binding && JSX_BY_IMPORT[binding.module];
      if (byImport && byImport.names.includes(binding.imported)) sites.push({ ...lineRange(sf, node), observed: byImport.label });
    }
  });
  return sites;
}

/** Each upload handler in shipped script files. */
export async function findUploadHandlers(repo: RepoIndex): Promise<StaticEvidence[]> {
  const evidence: StaticEvidence[] = [];
  for (const file of repo.files) {
    if (fileKind(file) !== 'script' || isNonShippingFile(file)) continue;
    const text = await repo.read(file);
    if (!HINT.test(text)) continue;
    const sf = await repo.sourceFile(file);
    if (!sf) continue;
    const map = new LineMap(text);
    for (const s of sitesIn(sf)) {
      evidence.push({ kind: 'static', file, ...s, snippet: map.snippet(s.startLine, Math.min(s.endLine, s.startLine + 1)) });
    }
  }
  return evidence;
}
