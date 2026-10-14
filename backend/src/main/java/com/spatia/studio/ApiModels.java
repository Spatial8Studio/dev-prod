package com.spatia.studio;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

record SignupRequest(@NotBlank @Email String email, @NotBlank @Size(min = 8) String password, @NotBlank String name) {}
record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {}
record AuthResponse(String token, UserView user) {}
record UserView(String id, String email, String name) {}
record UploadView(String id, String filename, long size, String contentType, Instant uploadedAt) {}
record SourceRequest(String uploadId, double x, double y, double z, String outputName) {}
record RenderView(String id, String filename, String status, String downloadUrl, String message, List<Double> position) {}
