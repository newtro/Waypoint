import {describe,expect,it} from 'vitest'
import {isEffectivelyMaximized,restoreWindowState} from './window-state.js'

const displays=[{id:'main',workArea:{x:0,y:0,width:1440,height:900}},{id:'side',workArea:{x:1440,y:0,width:1920,height:1080}}]
const fallback={x:130,y:70,width:1180,height:760}

describe('window state',()=>{
  it('restores valid bounds and maximized state on the saved display',()=>expect(restoreWindowState({bounds:{x:1600,y:100,width:1200,height:800},displayId:'side',maximized:true},displays,fallback)).toEqual({bounds:{x:1600,y:100,width:1200,height:800},displayId:'side',maximized:true}))
  it('recenters an off-screen window on the nearest available display',()=>expect(restoreWindowState({bounds:{x:6000,y:200,width:1200,height:800},displayId:'missing',maximized:false},displays,fallback).bounds).toEqual({x:1800,y:140,width:1200,height:800}))
  it('rejects corrupt or undersized saved bounds',()=>expect(restoreWindowState({bounds:{x:0,y:0,width:20,height:20},displayId:'main',maximized:true},displays,fallback)).toEqual({bounds:fallback,displayId:'main',maximized:false}))
  it('recognizes native macOS zoom bounds without relying on Electron maximize state',()=>{expect(isEffectivelyMaximized({x:1440,y:0,width:1920,height:1080},displays[1].workArea)).toBe(true);expect(isEffectivelyMaximized({x:1600,y:100,width:1200,height:800},displays[1].workArea)).toBe(false)})
})
