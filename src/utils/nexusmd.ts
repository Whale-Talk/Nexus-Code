/** @deprecated Use projectInstructions.js. */
export * from './projectInstructions.js'
export {
  getExternalInstructionIncludes as getExternalNexusMdIncludes,
  hasExternalInstructionIncludes as hasExternalNexusMdIncludes,
  renderInstructionContext as getNexusMds,
  shouldShowExternalInstructionWarning as shouldShowNexusMdExternalIncludesWarning,
  type ExternalInstructionInclude as ExternalNexusMdInclude,
} from './projectInstructions.js'
