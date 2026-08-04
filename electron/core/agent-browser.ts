import {accessSync,constants} from 'node:fs'
import path from 'node:path'

export const AGENT_BROWSER_VERSION='0.33.2'
export type BrowserProfileMode='existing'|'isolated'
export const BROWSER_COMMANDS=['open','snapshot','click','fill','wait','screenshot','close'] as const
export type BrowserCommand=typeof BROWSER_COMMANDS[number]

export function packagedAgentBrowser(resourcesPath:string,platform=process.platform){const name=platform==='win32'?'agent-browser.exe':'agent-browser',candidate=path.join(resourcesPath,'agent-browser',name);try{accessSync(candidate,constants.X_OK);return candidate}catch{return undefined}}
export function developmentAgentBrowser(root:string,platform=process.platform,arch=process.arch){const suffix=platform==='win32'?'win32-x64.exe':platform==='darwin'?`darwin-${arch}`:undefined;if(!suffix)return undefined;const candidate=path.join(root,'node_modules','agent-browser','bin',`agent-browser-${suffix}`);try{accessSync(candidate,constants.X_OK);return candidate}catch{return undefined}}
export function browserArguments(input:{command:BrowserCommand;args:string[];mode:BrowserProfileMode;profile:string;session:string;allowedDomains:string[];maxOutput?:number}){if(!BROWSER_COMMANDS.includes(input.command)||!/^[-_A-Za-z0-9]{1,80}$/.test(input.session)||input.args.length>20||input.args.some((item)=>item.length>4096||/[\0\r\n]/.test(item)))throw new Error('browser_arguments_invalid');if(!input.allowedDomains.length||input.allowedDomains.length>30||input.allowedDomains.some((item)=>!/^(?:\*\.)?[A-Za-z0-9.-]{1,253}$/.test(item)))throw new Error('browser_domains_invalid');if(input.mode==='existing'&&!/^[ A-Za-z0-9._-]{1,100}$/.test(input.profile))throw new Error('browser_profile_invalid');const profile=input.mode==='isolated'?input.profile:input.profile;return['--session',input.session,'--profile',profile,'--content-boundaries','--max-output',String(Math.min(262_144,Math.max(1,input.maxOutput??65_536))),'--allowed-domains',input.allowedDomains.join(','),'--headed','--json',input.command,...input.args]}
