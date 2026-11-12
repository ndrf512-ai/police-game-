// Реестр экранов: id → класс.
import { MenuScreen } from './menu.js';
import { NewGameScreen } from './newgame.js';
import { BriefingScreen } from './briefing.js';
import { CityMapScreen } from './citymap.js';
import { PersonnelScreen, HiringScreen } from './personnel.js';
import { OfficerScreen } from './officer.js';
import { DepartmentsScreen } from './departments.js';
import { DutyScreen } from './duty.js';
import { ArmoryScreen } from './armory.js';
import { SupplyScreen } from './supply.js';
import { StationPlanScreen } from './stationplan.js';
import { TalkScreen } from './talk.js';
import { DaySummaryScreen } from './daysummary.js';
import { GameOverScreen } from './gameover.js';
import { RadioScreen, TvScreen, DetaineesScreen, InterrogationScreen, VisitorScreen, OfferScreen, InboxScreen, PauseScreen, SettingsScreen, NotebookScreen } from './misc.js';

export const SCREENS = {
  menu: MenuScreen, newgame: NewGameScreen, briefing: BriefingScreen, citymap: CityMapScreen, personnel: PersonnelScreen, hiring: HiringScreen,
  officer: OfficerScreen, armory: ArmoryScreen, supply: SupplyScreen, stationplan: StationPlanScreen, talk: TalkScreen, daysummary: DaySummaryScreen,
  gameover: GameOverScreen, radio: RadioScreen, tv: TvScreen, detainees: DetaineesScreen, interrogation: InterrogationScreen, visitor: VisitorScreen,
  offer: OfferScreen, inbox: InboxScreen, pause: PauseScreen, settings: SettingsScreen, notebook: NotebookScreen,
  departments: DepartmentsScreen, duty: DutyScreen,
};
for (const [id, C] of Object.entries(SCREENS)) if (C && !C.id) C.id = id;
