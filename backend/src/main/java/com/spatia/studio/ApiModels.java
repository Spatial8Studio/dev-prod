package com.spatia.studio;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;

record SignupRequest(@NotBlank @Email String email, @NotBlank @Size(min = 8) String password, @NotBlank String name) {}
record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {}
record AuthResponse(String token, UserView user) {}
record UserView(String id, String email, String name) {}
record UploadView(String id, String filename, long size, String contentType, Instant uploadedAt) {}
record SourceRequest(String uploadId, double startX, double startY, double startZ,
                     double destinationX, double destinationY, double destinationZ,
                     double travelTimeSeconds) {}
record SceneRequest(List<SourceRequest> sources, String outputName) {}
record RenderView(String id, String filename, String status, String downloadUrl, String message, List<Double> position) {}
record ProjectRequest(String title, String description, String mode, boolean published, SceneRequest scene,
                      Map<String, String> assetNames, String renderId) {}
record PublishRequest(boolean published) {}
record ProjectView(String id, String title, String description, String mode, boolean published,
                  UserView owner, SceneRequest scene, Map<String, String> assetNames,
                  String renderId, Instant createdAt, Instant updatedAt) {}
record ArtistView(String id, String name, String email, int followers, boolean followed) {}
