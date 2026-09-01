# Built from source, so a clean checkout is all that is needed.
#
# Two stages: dependencies resolve in their own layer, keyed on the pom alone,
# so editing code does not re-download Maven Central.
FROM maven:3-eclipse-temurin-26 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
# Tests run in CI against a real Postgres and a real browser; repeating them
# here would need Docker inside Docker and would double every image build.
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:25-jre
ENV JAVA_OPTS="-Xms1g -Xmx2g -XX:MaxGCPauseMillis=10"
WORKDIR /app
COPY --from=build /src/target/clashofpokemon-server-*.jar app.jar
EXPOSE 4400
ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar app.jar"]
