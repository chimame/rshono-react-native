"use client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useServerScreen, useServerFunction } from "rshono-react-native";
import { incrementServerCounter } from "../../../server/src/actions";
export default function ServerControls({
  increment,
}: {
  increment: (amount: number) => Promise<number>;
}) {
  const { refresh, reset, pending } = useServerScreen();
  const importedIncrement = useServerFunction(incrementServerCounter);
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: (amount: number) => Promise<number>) => {
    try {
      setValue(await action(1));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <View>
      <Pressable accessibilityLabel="Refresh server screen" onPress={refresh}>
        <Text>{pending ? "Refreshing" : "Refresh"}</Text>
      </Pressable>
      <Pressable accessibilityLabel="Reset server screen" onPress={reset}>
        <Text>Reset</Text>
      </Pressable>
      <Pressable accessibilityLabel="Call server function prop" onPress={() => void run(increment)}>
        <Text>Increment server</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Call imported server function"
        onPress={() => void run(importedIncrement)}
      >
        <Text>Increment imported</Text>
      </Pressable>
      {value !== null && <Text>Action result: {value}</Text>}
      {error && <Text>Action failed: {error}</Text>}
    </View>
  );
}
