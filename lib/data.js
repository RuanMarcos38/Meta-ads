const roles={SUPER:'SUPER_ADMIN',ADMIN:'ADMIN',MANAGER:'MANAGER',USER:'USER'};
const permissions={SUPER_ADMIN:['*'],ADMIN:['read','manage','sync','export','features'],MANAGER:['read','sync','export'],USER:['read','export']};
const users=[
{id:'u1',tenantId:'t1',clientId:null,email:process.env.ADMIN_EMAIL||'admin@r2rmarketingdigital.com.br',name:'Administrador',role:'ADMIN',pass:process.env.ADMIN_PASSWORD||'123456'},
{id:'u2',tenantId:'t1',clientId:'c1',email:'cliente@r2rmarketingdigital.com.br',name:'Cliente R2R',role:'USER',pass:'123456'},
{id:'u3',tenantId:'t2',clientId:'c2',email:'outra@empresa.com.br',name:'Outra Empresa',role:'ADMIN',pass:'123456'}
];
const clients=[
{id:'c1',tenantId:'t1',name:'R2R Marketing Digital',tradeName:'R2R Marketing Digital',email:'admin@r2rmarketingdigital.com.br'},
{id:'cEco',tenantId:'t1',name:'Ecojoi',tradeName:'Ecojoi',email:'contato@ecojoi.com.br'},
{id:'c2',tenantId:'t2',name:'Empresa Isolada',tradeName:'Privado',email:'privado@empresa.com.br'}
];
const flags=[
{tenantId:'t1',featureName:'meta_ads',enabled:true},{tenantId:'t1',featureName:'google_ads',enabled:true},{tenantId:'t1',featureName:'reports_csv',enabled:true},
{tenantId:'t2',featureName:'meta_ads',enabled:false},{tenantId:'t2',featureName:'google_ads',enabled:false},{tenantId:'t2',featureName:'reports_csv',enabled:false}
];
module.exports={roles,permissions,users,clients,flags};
