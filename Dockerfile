FROM python:3.12-slim-bookworm AS assets
WORKDIR /assets
COPY scripts/fetch-font.py ./scripts/fetch-font.py
RUN python scripts/fetch-font.py

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
COPY templates ./templates
COPY static ./static
COPY schema.sql seed.json ./
COPY --from=assets /assets/static/fonts ./static/fonts
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre-jammy
LABEL org.opencontainers.image.source="https://github.com/eatyummydance200/library-dashboard"
WORKDIR /app
RUN useradd --uid 10001 --create-home app && mkdir /app/data && chown app:app /app/data
COPY --from=build /build/target/app.jar ./app.jar
USER app
EXPOSE 8000
ENV JAVA_TOOL_OPTIONS="-Xms32m -Xmx256m -XX:MaxMetaspaceSize=128m -XX:ReservedCodeCacheSize=64m"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
