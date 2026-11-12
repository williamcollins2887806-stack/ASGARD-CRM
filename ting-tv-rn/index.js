/**
 * @format
 */

import { AppRegistry } from 'react-native';
/* D-404: КРИТИЧНО. livekit-client в React Native не видит WebRTC, пока не
   вызван registerGlobals() — он подставляет RTCPeerConnection, mediaDevices и
   прочие API из react-native-webrtc в глобальную область. Без этого вызова
   создание Room падает с «WebRTC isn't detected, have you called
   registerGlobals?» — ровно та ошибка, что была на телеке, и из-за неё вход
   в зал был невозможен в принципе.
   Вызываем ДО рендера приложения, чтобы к моменту connect() глобалы уже были. */
import { registerGlobals } from '@livekit/react-native';

registerGlobals();

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
