import {createHash} from 'node:crypto'

export const RULE_EXTRACTOR={provider:'local-directives',version:'1.0.0',confidence:.9,maxMessages:500,maxCharacters:1_000_000,maxCandidates:100} as const
export interface RuleDirective{statement:string;normalized:string;excerpt:string;startOffset:number;endOffset:number;sourceDigest:string}

export function extractRuleDirectives(body:string):RuleDirective[]{if(body.length>100_000)return[];const result:RuleDirective[]=[];for(const match of body.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)){const raw=match[0],leading=raw.length-raw.trimStart().length,excerpt=raw.trim(),start=(match.index??0)+leading;if(!/^(?:always\s+|never\s+|please\s+.+\s+instead\b)/i.test(excerpt))continue;const statement=excerpt.replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim(),normalized=statement.toLocaleLowerCase('en-US');if(statement.length<8||statement.length>300)continue;result.push({statement,normalized,excerpt,startOffset:start,endOffset:start+excerpt.length,sourceDigest:createHash('sha256').update(body).digest('hex')})}return result}
