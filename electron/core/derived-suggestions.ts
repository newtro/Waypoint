import {createHash} from 'node:crypto'

export const SUGGESTION_EXTRACTOR={provider:'local-patterns',version:'1.0.0',threshold:0.72,maxPerScan:100} as const
export const SUGGESTION_SCAN_LIMITS={maxMessages:200,maxMessageCharacters:100_000,maxTotalCharacters:1_000_000} as const
export type SuggestionCategory='commitment'|'decision'|'fact'|'person'|'project'|'date'
export interface SuggestionCandidate{fingerprint:string;category:SuggestionCategory;title:string;body:string;sourceExcerpt:string;startOffset:number;endOffset:number;confidence:number}

const rules:Array<{category:SuggestionCategory;confidence:number;pattern:RegExp;title:string}>=[
  {category:'commitment',confidence:.93,pattern:/\b(?:I will|I'll|I need to|we need to|we will|must)\b|(?:^|\s)TODO:/i,title:'Commitment'},
  {category:'decision',confidence:.91,pattern:/\b(?:we decided|I decided|decision:|we(?:'ll| will) use)\b/i,title:'Decision'},
  {category:'fact',confidence:.84,pattern:/\b(?:remember that|fact:|note that)\b/i,title:'Fact'},
  {category:'person',confidence:.79,pattern:/\b(?:meet with|met with|talk to|ask|follow up with)\s+[A-Z][\p{L}'-]+/iu,title:'Person'},
  {category:'project',confidence:.82,pattern:/\b(?:project|initiative):\s*[\p{L}\p{N}][^.!?\n]{1,100}/iu,title:'Project'},
  {category:'date',confidence:.76,pattern:/\b(?:by|on|before)\s+(?:\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\b/i,title:'Date'}]

export function extractSuggestions(messageId:string,body:string):SuggestionCandidate[]{if(!messageId||body.length>2_000_000)throw new Error('Invalid suggestion source');const candidates:SuggestionCandidate[]=[];for(const segment of sentenceSegments(body)){for(const rule of rules){if(!rule.pattern.test(segment.text))continue;const normalized=segment.text.replace(/\s+/g,' ');if(normalized.length<4||normalized.length>500)continue;const fingerprint=createHash('sha256').update(JSON.stringify([SUGGESTION_EXTRACTOR.provider,SUGGESTION_EXTRACTOR.version,messageId,segment.start,segment.end,rule.category,normalized])).digest('hex');candidates.push({fingerprint,category:rule.category,title:rule.title,body:normalized,sourceExcerpt:segment.text,startOffset:segment.start,endOffset:segment.end,confidence:rule.confidence});if(candidates.length>=SUGGESTION_EXTRACTOR.maxPerScan)return candidates}}return candidates}

function* sentenceSegments(body:string):Generator<{text:string;start:number;end:number}>{for(const match of body.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)){const raw=match[0],leading=raw.length-raw.trimStart().length,text=raw.trim(),start=(match.index??0)+leading;if(text)yield{text,start,end:start+text.length}}}
