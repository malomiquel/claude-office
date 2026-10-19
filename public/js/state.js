// État partagé de la page et redessin global.
// Les modules modifient `state` puis appellent rerender() ; main.js enregistre les fonctions de rendu.

export const state = {
  agents: [],
  quota: null,
  selected: null, // id de l'agent dont le panneau est ouvert
  recentCwds: [], // dossiers des agents présents, proposés au recrutement
};

const renderers = [];
export const onRender = (fn) => renderers.push(fn);
export const rerender = () => { for (const fn of renderers) fn(); };

export const findAgent = (id) => state.agents.find((a) => a.id === id);
