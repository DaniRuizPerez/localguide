import * as FileSystem from 'expo-file-system/legacy';
import { MODEL_FILE_NAME } from '../config/constants';

export const MODEL_DIR = `${FileSystem.documentDirectory}models/`;
export const MODEL_LOCAL_PATH = `${MODEL_DIR}${MODEL_FILE_NAME}`;
