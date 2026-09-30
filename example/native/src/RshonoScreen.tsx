import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetch } from "expo/fetch";
import { RshonoProvider, ServerScreen } from "rshono-react-native";
export default function RshonoScreen() {
  const [serverUrl, setServerUrl] = useState(
    process.env.EXPO_PUBLIC_RSHONO_URL ||
      (Platform.OS === "android" ? "http://10.0.2.2:3100" : "http://127.0.0.1:3100"),
  );
  const [name, setName] = useState("React Native");
  const [request, setRequest] = useState({
    origin: serverUrl,
    name,
    revision: 0,
  });
  function connect() {
    setRequest((previous) => ({
      origin: serverUrl,
      name,
      revision: previous.revision + 1,
    }));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f5f7fa" }}
      contentContainerStyle={{ padding: 24, paddingTop: 72, gap: 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 26, fontWeight: "700", color: "#17283d" }}>
        RSHono × React Native
      </Text>
      <Text style={{ color: "#445469" }}>
        Render a server-built screen as native UI on your device.
      </Text>
      <View style={{ gap: 8 }}>
        <Text>Server</Text>
        <TextInput
          accessibilityLabel="Server URL"
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            backgroundColor: "white",
            padding: 12,
            borderRadius: 8,
            color: "#17283d",
          }}
        />
        <Text>Name sent to the server</Text>
        <TextInput
          accessibilityLabel="Name sent to the server"
          value={name}
          onChangeText={setName}
          style={{
            backgroundColor: "white",
            padding: 12,
            borderRadius: 8,
            color: "#17283d",
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void connect()}
        style={{ backgroundColor: "#244c87", padding: 16, borderRadius: 10 }}
      >
        <Text style={{ color: "white", textAlign: "center", fontWeight: "600" }}>
          Reload from server
        </Text>
      </Pressable>
      <RshonoProvider
        origin={request.origin}
        fetch={fetch}
        fallback={<ActivityIndicator />}
        renderError={(error, retry) => (
          <View>
            <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
              {error.message}
            </Text>
            <Pressable accessibilityRole="button" onPress={retry}>
              <Text>Retry</Text>
            </Pressable>
          </View>
        )}
      >
        <ServerScreen
          path="/native"
          searchParams={{ name: request.name }}
          reloadKey={request.revision}
        />
      </RshonoProvider>
    </ScrollView>
  );
}
