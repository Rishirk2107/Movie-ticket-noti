import { registerRootComponent } from 'expo';

// Register background notification task in global scope before root component mounts
import './src/services/notifications';
import App from './App';

registerRootComponent(App);
