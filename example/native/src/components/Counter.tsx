"use client";

import { useState } from "react";
import { Pressable, Text } from "react-native";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Increment local counter"
      onPress={() => setCount((value) => value + 1)}
      style={{ padding: 16, borderRadius: 10, backgroundColor: "#166547" }}
    >
      <Text style={{ color: "white", fontSize: 16 }}>Local counter: {count}</Text>
    </Pressable>
  );
}
