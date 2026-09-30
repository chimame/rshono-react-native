"use client";

import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function Panel({ children }: { children?: ReactNode }) {
  return (
    <View
      testID="rshono-server-panel"
      style={{
        padding: 20,
        gap: 16,
        borderRadius: 16,
        backgroundColor: "#e8f5ef",
      }}
    >
      {children}
    </View>
  );
}

export function Label({ children }: { children?: ReactNode }) {
  return <Text style={{ color: "#163a2d", fontSize: 16 }}>{children}</Text>;
}

export { default as Counter } from "./Counter";
