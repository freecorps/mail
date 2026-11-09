// Entry: the Android decrypt task must be defined at module top level, before the app registers (headless JS runs
// this file with no UI to open sealed pushes). Then expo-router's own entry.
import { defineEmberPushTask } from "@freecorps/ember-expo-push";

defineEmberPushTask();

import "expo-router/entry";
