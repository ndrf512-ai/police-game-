// Договорённости с бандами («не патрулировать район»): проверка нарушения, когда наряд прибыл в район.
import { clamp, glog } from './city_util.js';
import { gang } from './city_core.js';
import { dForm } from './city_data.js';

export function dealBreachCheck(game, t) {
  const f = game.state.flags || {}; const np = f.noPatrol && f.noPatrol[t.districtId];
  if (!np || np.broken || t.type === 'respond') return false;
  if (game.state.time.day > np.until) return false;
  np.broken = true;
  const g = gang(game, np.gangId); if (g) g.anger = clamp(g.anger + 25, 0, 100);
  glog(game, `Наряд появился ${dForm(t.districtId, 'prep')} вопреки договорённости. «${g ? g.name : 'Они'}» считают, что их кинули.`, 'important');
  return true;
}
