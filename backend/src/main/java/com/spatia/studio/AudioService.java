package com.spatia.studio;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Service
public class AudioService {
    private static final Logger log = LoggerFactory.getLogger(AudioService.class);
    private static final int MAX_SOURCES = 16;

    private final Path root;
    private final Path matlabDirectory;
    private final String matlabCommand;
    private final long matlabTimeoutSeconds;
    private final String hrirFile;
    private final ExecutorService renderExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "spatia-renderer");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<String, StoredUpload> uploads = new ConcurrentHashMap<>();
    private final Map<String, RenderJob> renders = new ConcurrentHashMap<>();

    public AudioService(
        @Value("${spatia.storage-root}") String storageRoot,
        @Value("${spatia.matlab-command}") String matlabCommand,
        @Value("${spatia.matlab-directory}") String matlabDirectory,
        @Value("${spatia.matlab-timeout-seconds}") long matlabTimeoutSeconds,
        @Value("${spatia.hrir-file}") String hrirFile
    ) throws IOException {
        this.root = Paths.get(storageRoot).toAbsolutePath().normalize();
        this.matlabDirectory = Paths.get(matlabDirectory).toAbsolutePath().normalize();
        this.matlabCommand = matlabCommand;
        this.matlabTimeoutSeconds = matlabTimeoutSeconds;
        this.hrirFile = hrirFile;
        Files.createDirectories(this.root);
        log.info("AudioService initialized: storageRoot={}, matlabCommand={}, matlabDirectory={}, hrirConfigured={}, timeoutSeconds={}",
            this.root, this.matlabCommand, this.matlabDirectory, this.hrirFile != null && !this.hrirFile.isBlank(), this.matlabTimeoutSeconds);
    }

    public UploadView save(MultipartFile file, String userId) {
        String name = fileName(Optional.ofNullable(file.getOriginalFilename()).orElse("audio.mp3"));
        log.info("UPLOAD received: userId={}, filename={}, size={} bytes, contentType={}",
            userId, name, file.getSize(), file.getContentType());
        if (!hasAudioExtension(name)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only MP3 and WAV files are supported");
        }
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a non-empty audio file");
        }

        String id = UUID.randomUUID().toString();
        Path destination = root.resolve(id + "-" + name);
        try {
            file.transferTo(destination);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not store upload", exception);
        }

        StoredUpload upload = new StoredUpload(id, userId, destination, name, file.getSize(), file.getContentType(), Instant.now());
        uploads.put(id, upload);
        log.info("UPLOAD stored: uploadId={}, path={}", id, destination);
        return new UploadView(id, name, upload.size(), upload.contentType(), upload.uploadedAt());
    }

    public RenderView render(SceneRequest request, String userId) {
        log.info("RENDER received: userId={}, sourceCount={}, requestedOutput={}",
            userId, request.sources() == null ? 0 : request.sources().size(), request.outputName());
        if (request.sources() == null || request.sources().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Add at least one audio source");
        }
        if (request.sources().size() > MAX_SOURCES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A scene can contain up to " + MAX_SOURCES + " sources");
        }

        List<StoredUpload> sourceUploads = request.sources().stream().map(source -> ownedUpload(source, userId)).toList();
        String id = UUID.randomUUID().toString();
        String outputName = outputFilename(request.outputName());
        Path output = root.resolve(id + "-" + outputName);
        SourceRequest first = request.sources().getFirst();
        RenderJob job = new RenderJob(id, userId, output, outputName, List.of(first.startX(), first.startY(), first.startZ()));
        renders.put(id, job);
        log.info("RENDER queued: renderId={}, sourceCount={}, output={}, firstSourceStart=[{}, {}, {}], firstSourceDestination=[{}, {}, {}]",
            id, sourceUploads.size(), output, first.startX(), first.startY(), first.startZ(),
            first.destinationX(), first.destinationY(), first.destinationZ());
        renderExecutor.submit(() -> process(job, request, sourceUploads));
        return job.view();
    }

    public RenderView renderStatus(String id, String userId) {
        return ownedRender(id, userId).view();
    }

    public Path renderFile(String id, String userId) {
        RenderJob job = ownedRender(id, userId);
        if (!"complete".equals(job.view().status()) || job.file() == null || !Files.isRegularFile(job.file())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The render is not ready to download");
        }
        return job.file();
    }

    public Path renderFileForPublic(String id) {
        RenderJob job = renders.get(id);
        if (job == null || !"complete".equals(job.view().status()) || job.file() == null || !Files.isRegularFile(job.file())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Published audio is not ready");
        }
        return job.file();
    }

    private void process(RenderJob job, SceneRequest request, List<StoredUpload> sourceUploads) {
        log.info("[{}] Render worker started: sourceCount={}, matlabConfigured={}",
            job.id(), sourceUploads.size(), matlabCommand != null && !matlabCommand.isBlank());
        job.update("processing", "MATLAB renderer is preparing the scene", null);
        try {
            if (matlabCommand == null || matlabCommand.isBlank()) {
                log.warn("[{}] MATLAB is not configured; creating an original-file preview", job.id());
                createPreview(job, sourceUploads.getFirst());
            } else {
                runMatlab(job, request, sourceUploads);
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            job.fail("The spatial renderer was interrupted");
            log.warn("[{}] Render interrupted", job.id(), exception);
        } catch (Exception exception) {
            job.fail("Spatial render failed: " + safeMessage(exception));
            log.error("[{}] Render failed: {}", job.id(), safeMessage(exception), exception);
        }
    }

    private void createPreview(RenderJob job, StoredUpload source) throws IOException {
        String previewName = nameWithoutExtension(job.filename()) + extension(source.filename());
        Path preview = root.resolve(job.id() + "-" + previewName);
        Files.copy(source.path(), preview, StandardCopyOption.REPLACE_EXISTING);
        job.complete(preview, previewName,
            "MATLAB is not configured, so this is the original source file rather than a spatial render");
        log.warn("[{}] Preview complete: copied {} to {}", job.id(), source.path(), preview);
    }

    private void runMatlab(RenderJob job, SceneRequest request, List<StoredUpload> sourceUploads) throws IOException, InterruptedException {
        if (!Files.isDirectory(matlabDirectory)) {
            throw new IOException("MATLAB scripts directory was not found");
        }

        // MATLAB's run() evaluates the script stem as an identifier. UUID hyphens
        // therefore become subtraction operators (for example, "8e17-..."), so
        // keep the generated MATLAB script filename identifier-safe.
        Path script = root.resolve("spatia_render_" + job.id().replace("-", "") + ".m");
        Path matlabLog = root.resolve(job.id() + ".matlab.log");
        try {
            String matlabProgram = matlabScript(request, sourceUploads, job.file());
            Files.writeString(script, matlabProgram);
            log.info("[{}] MATLAB launch requested: command={}, script={}, output={}, hrirConfigured={}",
                job.id(), matlabCommand, script, job.file(), hrirFile != null && !hrirFile.isBlank());
            log.info("[{}] MATLAB generated script:\n{}", job.id(), matlabProgram);
            log.info("[{}] Starting MATLAB process", job.id());
            Process process = new ProcessBuilder(
                matlabCommand,
                "-batch",
                "run('" + script.toAbsolutePath().toString().replace("\\", "/").replace("'", "''") + "')"
            ).redirectErrorStream(true).redirectOutput(matlabLog.toFile()).start();
            log.info("[{}] MATLAB process started: pid={}", job.id(), process.pid());

            if (!process.waitFor(matlabTimeoutSeconds, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IOException("MATLAB timed out after " + matlabTimeoutSeconds + " seconds");
            }
            String matlabOutput = readLog(matlabLog);
            if (!matlabOutput.isBlank()) {
                log.info("[{}] MATLAB output:\n{}", job.id(), matlabOutput);
            }
            if (process.exitValue() != 0) {
                log.error("[{}] MATLAB exited with code {}", job.id(), process.exitValue());
                throw new IOException("MATLAB exited with code " + process.exitValue());
            }
            if (!Files.isRegularFile(job.file())) {
                throw new IOException("MATLAB completed without an output file");
            }
            log.info("[{}] MATLAB exited successfully; output size={} bytes", job.id(), Files.size(job.file()));
            job.complete(job.file(), job.filename(), "Rendered " + request.sources().size() + " source(s) with two-factor Left/Right earphone binaural processing");
            log.info("[{}] Render complete: {}", job.id(), job.file());
        } finally {
            if (Files.exists(matlabLog)) {
                log.info("[{}] Removing temporary MATLAB script/log", job.id());
            }
            Files.deleteIfExists(script);
            Files.deleteIfExists(matlabLog);
        }
    }

    private String readLog(Path logFile) {
        try {
            if (!Files.isRegularFile(logFile)) {
                return "";
            }
            String output = Files.readString(logFile);
            int maximumLength = 12000;
            return output.length() <= maximumLength
                ? output
                : "[MATLAB output truncated]\n" + output.substring(output.length() - maximumLength);
        } catch (IOException exception) {
            return "[Could not read MATLAB output: " + exception.getMessage() + "]";
        }
    }

    private RenderJob ownedRender(String id, String userId) {
        RenderJob render = renders.get(id);
        if (render == null || !render.userId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Render not found");
        }
        return render;
    }

    private StoredUpload ownedUpload(SourceRequest source, String userId) {
        StoredUpload upload = uploads.get(source.uploadId());
        if (upload == null || !upload.userId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Upload not found");
        }
        validatePosition(source.startX(), source.startY(), source.startZ());
        validatePosition(source.destinationX(), source.destinationY(), source.destinationZ());
        if (!Double.isFinite(source.travelTimeSeconds()) || source.travelTimeSeconds() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Transition time must be greater than zero");
        }
        return upload;
    }

    private void validatePosition(double x, double y, double z) {
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Source coordinates must be valid numbers");
        }
    }

    private String matlabScript(SceneRequest request, List<StoredUpload> sourceUploads, Path output) {
        StringBuilder script = new StringBuilder("addpath('")
            .append(matlabDirectory.toAbsolutePath().toString().replace("\\", "/").replace("'", "''")).append("');\n")
            .append("sources = struct('inputFile',{},'startPosition',{},'destinationPosition',{},'travelTime',{});\n");
        for (int index = 0; index < request.sources().size(); index++) {
            SourceRequest source = request.sources().get(index);
            StoredUpload upload = sourceUploads.get(index);
            // In pure Left/Right earphone model, Y represents lateral positioning (+Y = left, -Y = right),
            // while elevation Z is 0 and forward distance X defaults to 1.0.
            double startX = Math.abs(source.startX()) < 0.001 && Math.abs(source.startZ()) < 0.001 ? 1.0 : source.startX();
            double startY = source.startY();
            double startZ = 0.0;
            double destX = Math.abs(source.destinationX()) < 0.001 && Math.abs(source.destinationZ()) < 0.001 ? 1.0 : source.destinationX();
            double destY = source.destinationY();
            double destZ = 0.0;
            script.append("sources(").append(index + 1).append(").inputFile='").append(upload.path().toAbsolutePath().toString().replace("\\", "/").replace("'", "''")).append("';\n")
                .append("sources(").append(index + 1).append(").startPosition=[").append(startX).append(" ").append(startY).append(" ").append(startZ).append("];\n")
                .append("sources(").append(index + 1).append(").destinationPosition=[").append(destX).append(" ").append(destY).append(" ").append(destZ).append("];\n")
                .append("sources(").append(index + 1).append(").travelTime=").append(source.travelTimeSeconds()).append(";\n");
        }
        script.append("renderScene(sources,'").append(output.toAbsolutePath().toString().replace("\\", "/").replace("'", "''"))
            .append("','FfmpegPath','ffmpeg'");
        if (hrirFile == null || hrirFile.isBlank()) {
            script.append(",'AllowSynthetic',true");
        } else {
            script.append(",'HrirFile','").append(hrirFile.replace("\\", "/").replace("'", "''"))
                .append("','AllowSynthetic',false");
        }
        return script.append(");\n").toString();
    }

    private String fileName(String candidate) {
        String name = Paths.get(candidate).getFileName().toString().replaceAll("[^A-Za-z0-9._ -]", "_");
        return name.isBlank() ? "audio.mp3" : name;
    }

    private String outputFilename(String requested) {
        String name = fileName(Optional.ofNullable(requested).filter(value -> !value.isBlank()).orElse("spatia-render.mp3"));
        return name.toLowerCase(Locale.ROOT).endsWith(".mp3") ? name : name + ".mp3";
    }

    private boolean hasAudioExtension(String name) {
        String normalized = name.toLowerCase(Locale.ROOT);
        return normalized.endsWith(".mp3") || normalized.endsWith(".wav");
    }

    private String extension(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(dot).toLowerCase(Locale.ROOT) : ".mp3";
    }

    private String nameWithoutExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(0, dot) : filename;
    }

    private String safeMessage(Exception exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? "an unexpected error occurred" : message;
    }

    @PreDestroy
    void stopRenderer() {
        renderExecutor.shutdownNow();
    }

    private record StoredUpload(String id, String userId, Path path, String filename, long size, String contentType, Instant uploadedAt) {}

    private static final class RenderJob {
        private final String id;
        private final String userId;
        private final Path requestedOutput;
        private final String requestedFilename;
        private final List<Double> position;
        private volatile Path file;
        private volatile RenderView view;

        private RenderJob(String id, String userId, Path requestedOutput, String requestedFilename, List<Double> position) {
            this.id = id;
            this.userId = userId;
            this.requestedOutput = requestedOutput;
            this.requestedFilename = requestedFilename;
            this.position = position;
            this.file = requestedOutput;
            this.view = new RenderView(id, requestedFilename, "queued", null, "Render queued", position);
        }

        private String id() { return id; }
        private String userId() { return userId; }
        private Path file() { return file; }
        private String filename() { return view.filename(); }
        private RenderView view() { return view; }

        private synchronized void update(String status, String message, String downloadUrl) {
            view = new RenderView(id, view.filename(), status, downloadUrl, message, position);
        }

        private synchronized void complete(Path file, String filename, String message) {
            this.file = file;
            view = new RenderView(id, filename, "complete", "/api/audio/renders/" + id + "/download", message, position);
        }

        private synchronized void fail(String message) {
            view = new RenderView(id, view.filename(), "failed", null, message, position);
        }
    }
}
