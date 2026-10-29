// This fixed registry controls destinations; browsers submit only these keys.
export const socialTargets={
  telegram_1:{platform:'telegram',label:'Telegram · Эдуард Шилов',idVariable:'TELEGRAM_1_CHANNEL_ID',labelVariable:'TELEGRAM_1_LABEL',secretVariable:'TELEGRAM_1_BOT_TOKEN',sharedSecret:'TELEGRAM_BOT_TOKEN'},
  telegram_2:{platform:'telegram',label:'Telegram · ТРОiКА',idVariable:'TELEGRAM_2_CHANNEL_ID',labelVariable:'TELEGRAM_2_LABEL',secretVariable:'TELEGRAM_2_BOT_TOKEN',sharedSecret:'TELEGRAM_BOT_TOKEN'},
  vk_troika:{platform:'vk',label:'VK · ТРОiКА (troikaband)',idVariable:'VK_TROIKA_GROUP_ID',secretVariable:'VK_TROIKA_ACCESS_TOKEN',sharedSecret:'VK_ACCESS_TOKEN'},
  vk_eduard:{platform:'vk',label:'VK · Эдуард Шилов (esh.music)',idVariable:'VK_EDUARD_GROUP_ID',secretVariable:'VK_EDUARD_ACCESS_TOKEN',sharedSecret:'VK_ACCESS_TOKEN'}
};
export function enabledSocialTargets(env){
  if(env.SOCIAL_TARGETS===undefined)return Object.keys(socialTargets);
  const keys=String(env.SOCIAL_TARGETS).split(',').map(x=>x.trim());
  if(!keys.length||new Set(keys).size!==keys.length||keys.some(x=>!socialTargets[x]))return [];
  return keys;
}
export function resolveSocialTarget(key,env){
  const definition=socialTargets[key];if(!definition)return null;
  const raw=String(env[definition.idVariable]??''),valid=definition.platform==='telegram'?/^(@[A-Za-z][A-Za-z0-9_]{4,31}|-100\d{5,20})$/.test(raw):/^[1-9]\d{0,18}$/.test(raw);
  const label=String((definition.labelVariable&&env[definition.labelVariable])||definition.label).replace(/[\x00-\x1f\x7f]/g,'').slice(0,100);
  const enabled=enabledSocialTargets(env).includes(key);
  return {platform:definition.platform,label,enabled,id:enabled&&valid?(raw.startsWith('@')?raw.toLowerCase():raw):'',token:enabled?(env[definition.secretVariable]||env[definition.sharedSecret]||''):''};
}
