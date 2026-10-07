export * from './types.ts';
export * from './schemas.ts';
export { defineRule, type RuleDefinition } from './define-rule.ts';
export { DISCLAIMER, evaluateCapture, scanRepo, scanSite, type ScanOptions } from './engine.ts';
export { findingId } from './finding-id.ts';
export { isLocalTarget, isPublicAddress } from './net/address.ts';
export { contentHash, recordJudgment, type StoredJudgment, type StoredJudgments } from './judgments.ts';
export { guidanceFor, type SelectedGuidance, type SelectedStep } from './fix-guidance.ts';
export { matchTopics, type TopicMatch } from './preflight.ts';
export {
  CONFIG_FILE,
  ConfigError,
  EU_EEA_COUNTRIES,
  INTAKE_QUESTIONS,
  appliesToEuVisitors,
  intakeQuestions,
  loadConfig,
  mergeIntake,
  updateConfigFile,
} from './intake.ts';
export { formatHtml } from './report/html.ts';
export { formatText } from './report/text.ts';
export { defaultReportPath, REPORT_DIR, writeHtmlReport } from './report/write-html.ts';
export { captureSite, pickFollowLinks, PlaywrightMissingError, userAgent, type CaptureOptions } from './runtime/crawler.ts';
export { jsxAttributeString, lineRange, parseSource, ts, walk } from './static/ast.ts';
export { fileKind, isNonShippingFile, type FileKind } from './static/file-kinds.ts';
export {
  ancestors,
  calleeText,
  importsOf,
  isTruthyLiteral,
  markupText,
  objectProp,
  propertyName,
  scriptText,
  stringValue,
  type ImportBinding,
} from './static/js.ts';
export { buildRepoIndex } from './static/repo-index.ts';
export { listRoutes, type RouteInfo } from './static/routes.ts';
export { LineMap, stripCssComments, stripHtmlComments } from './static/text.ts';
