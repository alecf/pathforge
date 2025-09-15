const config = {
  input: "https://developers.strava.com/swagger/swagger.json", // sign up at app.heyapi.dev
  output: "src/strava-client",
  plugins: [
    // ...other plugins
    {
      asClass: false,
      name: "@hey-api/sdk",
    },
  ],
};

export default config;
